// Load environment variables from .env file
require('dotenv').config();

const express = require('express'); 
const bodyParser = require('body-parser');
const { MongoClient } = require('mongodb');
const ExcelJS = require('exceljs');  // Import the ExcelJS module
const crypto = require('crypto');
const nodemailer = require('nodemailer');
const bcrypt = require('bcryptjs');
const path = require('path');

const app = express();
app.use(bodyParser.urlencoded({ extended: true }));

// Set EJS as the templating engine
app.set('view engine', 'ejs'); 
app.set('views', __dirname + '/views');

// MongoDB Connection URL (using environmental variable)
const uri = process.env.MONGO_URI;  // Fetch URI from environment variable

// Connect to MongoDB
MongoClient.connect(uri)
  .then(client => {
    console.log('Connected to Database');
    const db = client.db('supplier_db');
    const suppliersCollection = db.collection('suppliers'); // Suppliers collection
    const usersCollection = db.collection('users'); // Users collection

    // Serve the main index page
    app.get('/', (req, res) => {
      res.sendFile(__dirname + '/index.html');
    });

    // Serve the login and signup pages
    app.get('/login', (req, res) => res.sendFile(__dirname + '/login.html'));
    app.get('/signup', (req, res) => res.sendFile(__dirname + '/signup.html'));

    // Handle sign-up logic
    app.post('/signup', async (req, res) => {
      const { name, email, companyName, password } = req.body;
      const collectionName = companyName.toLowerCase().replace(/\s+/g, ''); // Generate collection name from company

      try {
        // Insert user information into the 'users' collection
        await usersCollection.insertOne({ name, email, password, companyName });

        // Create a new collection for the company within the existing 'supplier_db'
        await db.createCollection(collectionName);

        // Respond with a message containing the custom URL
        res.send(`Account created for ${companyName}. Access your supplier form at: http://www.supplierdb.info:${process.env.PORT || 3000}/${collectionName}`);
      } catch (error) {
        console.error('Error creating company collection:', error);
        res.status(500).send('Error creating your company account. Please try again.');
      }
    });

    // Serve the supplier form for the company
    app.get('/:company', (req, res) => {
      const companyName = req.params.company;
      res.render('supplier_form', { companyName }); // Render an EJS template with the company name
    });

    // Serve the login page
    app.get('/login', (req, res) => {
      res.sendFile(__dirname + '/login.html');
    });

    // Handle login
    app.post('/login', async (req, res) => {
      const { companyName, password } = req.body;

      try {
        // Fetch the user from the database
        const user = await usersCollection.findOne({ companyName: companyName });

        // Check if user exists and password matches
        if (user && user.password === password) {
          res.send(`Welcome, ${companyName}!`);
        } else {
          res.status(401).send('Invalid credentials. Please try again.');
        }
      } catch (error) {
        console.error('Error logging in:', error);
        res.status(500).send('An error occurred during login. Please try again.');
      }
    });

    // Handle form submission for suppliers
    app.post('/submit', (req, res) => {
      const supplierData = {
        supplierID: req.body.supplierID,
        name: req.body.name,
        company: req.body.company,
        email: req.body.email,
        company_phone_number: req.body.company_phone_number,
        mobile_phone_number: req.body.mobile_phone_number || null, // Optional field
        core_business: req.body.core_business,
        website: req.body.website || null, // Optional field
        postcode: req.body.postcode || null // Optional field
      };

      // Insert supplier data into MongoDB
      suppliersCollection.insertOne(supplierData)
        .then(result => {
          console.log('Supplier data saved to database');
          res.send('Supplier data submitted successfully');
        })
        .catch(err => {
          console.error('Error inserting data:', err);
          res.status(500).send('Failed to add supplier');
        });
    });

    // Route to display all suppliers
    app.get('/suppliers', (req, res) => {
      suppliersCollection.find().toArray()
        .then(results => {
          res.render('suppliers', { suppliers: results });
        })
        .catch(error => console.error(error));
    });

    // Add the Excel download route
    app.get('/download', async (req, res) => {
      try {
        const workbook = new ExcelJS.Workbook();
        const worksheet = workbook.addWorksheet('Suppliers');

        // Add headers
        worksheet.columns = [
          { header: 'Supplier ID', key: 'supplierID', width: 15 },
          { header: 'Name', key: 'name', width: 20 },
          { header: 'Company', key: 'company', width: 20 },
          { header: 'Email', key: 'email', width: 25 },
          { header: 'Phone 1', key: 'company_phone_number', width: 15 },
          { header: 'Phone 2', key: 'mobile_phone_number', width: 15 },
          { header: 'Products', key: 'core_business', width: 20 },
          { header: 'Website', key: 'website', width: 25 },
          { header: 'Postal Code', key: 'postcode', width: 10 },
        ];

        // Fetch data from MongoDB
        const suppliers = await suppliersCollection.find().toArray();

        // Add rows with data
        suppliers.forEach(supplier => {
          worksheet.addRow(supplier);
        });

        // Set response header
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', 'attachment; filename=suppliers.xlsx');

        // Write the Excel file to response
        await workbook.xlsx.write(res);
        res.end();
      } catch (err) {
        console.error('Error generating Excel:', err);
        res.status(500).send('Error generating Excel file');
      }
    });

    // Start the server
    app.listen(process.env.PORT || 3000, () => {
      console.log(`Server running on http://localhost:${process.env.PORT || 3000}`);
    });

  })
  .catch(error => {
    console.error('Failed to connect to database:', error);
  });

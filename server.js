require('dotenv').config(); // Load environment variables from .env file

const express = require('express');
const bodyParser = require('body-parser');
const { MongoClient } = require('mongodb');
const ExcelJS = require('exceljs');
const bcrypt = require('bcryptjs');
const path = require('path');

const app = express();
app.use(bodyParser.urlencoded({ extended: true }));

// Set EJS as the templating engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Environment variables
const PORT = process.env.PORT || 3000;
const MONGO_URI = process.env.MONGO_URI;

// Connect to MongoDB
MongoClient.connect(MONGO_URI)
  .then(client => {
    console.log('Connected to Database');
    const db = client.db('supplier_db');
    const suppliersCollection = db.collection('suppliers');
    const customer_usersCollection = db.collection('customer_users');

    // Serve the main index page
    app.get('/', (req, res) => {
      res.sendFile(path.join(__dirname, 'index.html'));
    });

    // Serve login-selection page
    app.get('/login', (req, res) => {
      res.sendFile(path.join(__dirname, 'login-selection.html'));
    });

    // Serve login forms for customer and supplier
    app.get('/customer/login', (req, res) => {
      res.sendFile(path.join(__dirname, 'customer-login.html'));
    });

    app.get('/supplier/login', (req, res) => {
      res.sendFile(path.join(__dirname, 'supplier-login.html'));
    });

    // Serve signup page
    app.get('/signup', (req, res) => {
      res.sendFile(path.join(__dirname, 'signup.html'));
    });

    app.post('/signup', async (req, res) => {
      try {
        const { name, email, companyName, password } = req.body;

        // Hash the password
        const hashedPassword = await bcrypt.hash(password, 10);

        // Normalize collectionName for consistency
        const collectionName = companyName.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');

        // Insert user information into the 'customer users' collection
        await customer_usersCollection.insertOne({ name, email, password: hashedPassword, companyName });

        // Create a new collection for the company within the 'supplier_db'
        await db.createCollection(collectionName);

        // Generate the custom path
        const normalizedCompanyName = collectionName.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
        const customPath = `/${normalizedCompanyName}`;

       // Define the Heroku URL
       const herokuUrl = 'https://supplydb-7b5704f73b0d.herokuapp.com';

        // Respond with the EJS template
        res.render('signupResponse', { companyName, customPath });
      } catch (error) {
        console.error('Error creating company collection:', error);
        res.status(500).send('Error creating your company account. Please try again.');
      }
    });

    // Serve the supplier form
    app.get('/:company', (req, res) => {
      try {
        const companyName = req.params.company;

        // Normalize the company name to match the collectionName logic
        const normalizedCompanyName = companyName.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');

        res.render('supplier_form', { companyName: normalizedCompanyName });
      } catch (error) {
        console.error('Error serving supplier form:', error);
        res.status(500).send('Error loading supplier form. Please try again.');
      }
    });

    // Handle login section
    app.post('/customer/login', async (req, res) => {
      const { email, password } = req.body;

      try {
        // Check if the user is a customer in the database
        const customer = await customer_usersCollection.findOne({ email: email.toLowerCase() });

        if (customer && await bcrypt.compare(password, customer.password)) {
          res.render('loginResponse', {
            userType: 'customer',
            companyName: customer.companyName,
            // Directing the user to the supplier list for their company
            downloadLink: `/suppliers/${customer.companyName}` // Updated link for suppliers page
          });
        } else {
          res.status(401).send('Invalid email or password. Please try again.');
        }
      } catch (error) {
        console.error('Error logging in customer:', error);
        res.status(500).send('An error occurred during login. Please try again.');
      }
    });

    // Route to show suppliers for a specific company
    app.get('/suppliers/:companyName', async (req, res) => {
      const { companyName } = req.params;

      try {
        const collectionName = companyName.replace(/\s+/g, '-').toLowerCase();
        const collection = db.collection(collectionName);

        let suppliers = await collection.find().toArray();

        // Deduplicate suppliers
        const uniqueSuppliers = Array.from(
          new Map(suppliers.map(s => [s.supplierID, s])).values()
        );

        res.render('suppliers', { suppliers: uniqueSuppliers });
      } catch (error) {
        console.error('Error fetching suppliers:', error);
        res.status(500).send('An error occurred while fetching the suppliers.');
      }
    });

    // Handle form submission for a specific supplier
    app.post('/submit/:company', async (req, res) => {
      try {
        const companyName = req.params.company; // Get company name from the URL

        // Normalize the company name to match the collectionName logic used in `/signup`
        const collectionName = companyName.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');

        // Fetch the specific collection for the company
        const targetCollection = db.collection(collectionName);

        // Create the supplier data object
        const supplierData = {
          supplierID: req.body.supplierID,
          name: req.body.name,
          company: companyName,
          email: req.body.email,
          company_phone_number: req.body.company_phone_number,
          mobile_phone_number: req.body.mobile_phone_number || null, // Optional
          core_business: req.body.core_business,
          website: req.body.website || null, // Optional
          postcode: req.body.postcode || null // Optional
        };

        // Insert the supplier data into the specific company collection
        await targetCollection.insertOne(supplierData);

        console.log('Supplier data saved to database in collection:', collectionName);
        res.render('supplier-submission-confirmation', { companyName });
      } catch (err) {
        console.error('Error inserting data:', err);
        res.status(500).send('Failed to add supplier');
      }
    });

    // Add the Excel download route
    app.get('/download/:companyName', async (req, res) => {
      const { companyName } = req.params;

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

        // Fetch suppliers from the company's collection
        const collectionName = companyName.replace(/\s+/g, '-').toLowerCase();
        const collection = db.collection(collectionName);
        const suppliers = await collection.find().toArray();

        // Deduplicate rows
        const seen = {};
        suppliers.forEach(supplier => {
          const key = `${supplier.supplierID}-${supplier.email}`; // Unique key
          if (!seen[key]) {
            worksheet.addRow(supplier); // Add only if not seen
            seen[key] = true;
          }
        });

        // Set response headers
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename=${companyName}_suppliers.xlsx`);

        // Write the Excel file to response
        await workbook.xlsx.write(res);
        res.end();
      } catch (error) {
        console.error('Error generating Excel:', error);
        res.status(500).send('Error generating Excel file');
      }
    });

    // Start the server
    app.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
    });

  })
  .catch(error => {
    console.error('Failed to connect to database:', error);
  });



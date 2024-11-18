const express = require('express');
const { MongoClient } = require('mongodb');
const ExcelJS = require('exceljs');
const crypto = require('crypto');
const nodemailer = require('nodemailer');
const bcrypt = require('bcryptjs');
const path = require('path');

const app = express();
const PORT = 3000; // Hardcoded port
const uri = "mongodb+srv://webform_user:WebForm@project1.poswy.mongodb.net/supplier_db?retryWrites=true&w=majority"; // Hardcoded MongoDB URI

// Gmail credentials hardcoded
const GMAIL_USER = "your-email@gmail.com";  // Hardcoded Gmail user
const GMAIL_PASS = "your-email-password";  // Hardcoded Gmail password

// Middleware
app.use(express.urlencoded({ extended: true }));
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static('public'));

// MongoDB Connection
MongoClient.connect(uri)
  .then(client => {
    console.log('Connected to Database');
    const db = client.db('supplier_db');
    const usersCollection = db.collection('users');

    // Routes
    app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
    app.get('/login', (req, res) => res.sendFile(path.join(__dirname, 'login-selection.html')));
    app.get('/supplier/login', (req, res) => res.sendFile(path.join(__dirname, 'supplier-login.html')));
    app.get('/customer/login', (req, res) => res.sendFile(path.join(__dirname, 'customer-login.html')));
    app.get('/signup', (req, res) => res.sendFile(path.join(__dirname, 'signup.html')));
    app.get('/forgot-password', (req, res) => res.sendFile(path.join(__dirname, 'forgot-password.html')));

    app.post('/signup', async (req, res) => {
      const { name, email, companyName, password } = req.body;
      const collectionName = companyName.toLowerCase().replace(/\s+/g, '');

      try {
        // Check if the collection already exists
        const collections = await db.listCollections().toArray();
        const collectionExists = collections.some(collection => collection.name === collectionName);

        if (!collectionExists) {
          await db.createCollection(collectionName);
        }

        const hashedPassword = await bcrypt.hash(password, 10);
        await usersCollection.insertOne({ name, email, companyName, password: hashedPassword });

        const customURL = `http://localhost:${PORT}/${collectionName}`;
        res.render('signupResponse', { companyName, customURL });
      } catch (error) {
        console.error('Error in signup route:', error);
        res.status(500).send('Error creating your company account. Please try again.');
      }
    });

    app.post('/forgot-password', async (req, res) => {
      const { email } = req.body;

      try {
        const user = await usersCollection.findOne({ email });
        if (!user) {
          return res.status(404).send('User with this email does not exist.');
        }

        const resetToken = crypto.randomBytes(32).toString('hex');
        const resetTokenExpiry = Date.now() + 3600000;
        await usersCollection.updateOne({ email }, { $set: { resetToken, resetTokenExpiry } });

        const resetURL = `https://your-domain.com/reset-password/${resetToken}`;
        const transporter = nodemailer.createTransport({
          service: 'gmail',
          auth: {
            user: GMAIL_USER,  // Using hardcoded Gmail user
            pass: GMAIL_PASS,  // Using hardcoded Gmail password
          },
        });

        const mailOptions = {
          from: GMAIL_USER,
          to: email,
          subject: 'Password Reset',
          html: `<p>You requested a password reset. Click <a href="${resetURL}">here</a> to reset your password.</p>`,
        };

        transporter.sendMail(mailOptions, (err, info) => {
          if (err) {
            console.error('Error sending email:', err);
            res.status(500).send('Error sending reset email.');
          } else {
            res.send('Password reset email sent.');
          }
        });
      } catch (error) {
        console.error('Error in forgot-password route:', error);
        res.status(500).send('An error occurred during password reset. Please try again.');
      }
    });

    app.get('/:company', (req, res) => {
      const companyName = req.params.company;
      res.render('supplier_form', { companyName });
    });

    app.post('/submit/:company', async (req, res) => {
      const companyName = req.params.company.toLowerCase();
      const supplierData = req.body;

      try {
        const collection = db.collection(companyName);
        await collection.insertOne(supplierData);
        res.render('supplier-submission-confirmation', { companyName });
      } catch (err) {
        console.error('Error inserting data:', err);
        res.status(500).send('Failed to add supplier');
      }
    });

    app.get('/download/:company', async (req, res) => {
      const companyName = req.params.company;
      const workbook = new ExcelJS.Workbook();
      const worksheet = workbook.addWorksheet('Suppliers');

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

      try {
        const collection = db.collection(companyName.toLowerCase());
        const suppliers = await collection.find().toArray();

        suppliers.forEach(supplier => {
          worksheet.addRow(supplier);
        });

        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename=${companyName}_suppliers.xlsx`);

        await workbook.xlsx.write(res);
        res.end();
      } catch (err) {
        console.error('Error generating Excel:', err);
        res.status(500).send('Error generating Excel file');
      }
    });

    app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
  })
  .catch(error => {
    console.error('Error connecting to MongoDB:', error.message);
    process.exit(1); // Exit the application if DB connection fails
  });

// General error handling middleware
app.use((err, req, res, next) => {
  console.error('Unhandled Error:', err.stack);
  res.status(500).send('Internal Server Error');
});

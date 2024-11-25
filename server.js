require('dotenv').config(); // Load environment variables from .env file
const express = require('express');
const { MongoClient } = require('mongodb');
const ExcelJS = require('exceljs');
const crypto = require('crypto');
const nodemailer = require('nodemailer');
const bcrypt = require('bcryptjs');
const path = require('path');

const app = express();

// Environmental Variables
const PORT = process.env.PORT || 3000; // Use Heroku's PORT or default to 3000 locally
const MONGO_URI = process.env.MONGO_URI; // MongoDB connection string
const GMAIL_USER = process.env.GMAIL_USER; // Gmail username
const GMAIL_PASS = process.env.GMAIL_PASS; // Gmail password
const HEROKU_APP_NAME = process.env.HEROKU_APP_NAME || ''; // Heroku app name for dynamic URL generation

// Check if all necessary environmental variables are defined
if (!MONGO_URI || !GMAIL_USER || !GMAIL_PASS) {
  console.error("Missing required configuration variables. Please set them in the environment or .env file.");
  process.exit(1);
}

// Middleware
app.use(express.urlencoded({ extended: true }));
app.use(express.json()); // To handle JSON requests
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static('public'));

// MongoDB Connection
(async () => {
  try {
    const client = await MongoClient.connect(MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true });
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

    // Signup Route
app.post('/signup', async (req, res) => {
  const { name, email, companyName, password } = req.body;

  // Input Validation
  if (!email || !email.includes('@')) {
    return res.status(400).send('Invalid email address. Please ensure it contains an @ symbol.');
  }

  // Generate Collection Name (no hashing)
  const collectionName = companyName.toLowerCase().trim().slice(0, 24);

  try {
    console.log('Creating collection with name:', collectionName);

    // Check if the collection already exists
    const collections = await db.listCollections().toArray();
    const collectionExists = collections.some(collection => collection.name === collectionName);

    if (!collectionExists) {
      await db.createCollection(collectionName);
    }

    // Hash Password and Save User
    const hashedPassword = await bcrypt.hash(password, 10);
    await usersCollection.insertOne({ name, email, companyName, password: hashedPassword });

    // Generate Custom URL
    const customURL = HEROKU_APP_NAME
      ? `https://${HEROKU_APP_NAME}.herokuapp.com/${collectionName}`
      : `http://localhost:${PORT}/${collectionName}`;

    // Debug logging
    console.log('Company Name:', companyName);
    console.log('Custom URL:', customURL);

    res.render('signupResponse', { companyName, customURL }, (err, html) => {
      if (err) {
        console.error('Render error in signupResponse:', err);
        return res.status(500).send('Template rendering failed. Please try again.');
      }
      res.send(html);
    });
  } catch (error) {
    console.error('Error in signup route:', error);
    res.status(500).send('Error creating your company account. Please try again.');
  }
});

    // Forgot Password Route
    app.post('/forgot-password', async (req, res) => {
      const { email } = req.body;

      if (!email || !email.includes('@')) {
        return res.status(400).send('Invalid email address.');
      }

      try {
        const user = await usersCollection.findOne({ email });
        if (!user) {
          return res.status(404).send('User with this email does not exist.');
        }

        const resetToken = crypto.randomBytes(32).toString('hex');
        const hashedToken = crypto.createHash('sha256').update(resetToken).digest('hex');
        const resetTokenExpiry = Date.now() + 3600000; // 1 hour
        await usersCollection.updateOne({ email }, { $set: { resetToken: hashedToken, resetTokenExpiry } });

        const resetURL = HEROKU_APP_NAME
          ? `https://${HEROKU_APP_NAME}.herokuapp.com/reset-password/${resetToken}`
          : `http://localhost:${PORT}/reset-password/${resetToken}`;

        const transporter = nodemailer.createTransport({
          service: 'gmail',
          auth: {
            user: GMAIL_USER,
            pass: GMAIL_PASS,
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
      const companyName = req.params.company.toLowerCase();
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
        const collection = db.collection(companyName);
        const suppliers = await collection.find().toArray();

        const formattedSuppliers = suppliers.map(s => ({
          supplierID: s.supplierID || 'N/A',
          name: s.name || '',
          company: s.company || '',
          email: s.email || '',
          company_phone_number: s.company_phone_number || '',
          mobile_phone_number: s.mobile_phone_number || '',
          core_business: s.core_business || '',
          website: s.website || '',
          postcode: s.postcode || '',
        }));

        worksheet.addRows(formattedSuppliers);

        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename=${companyName}_suppliers.xlsx`);

        await workbook.xlsx.write(res);
        res.end();
      } catch (err) {
        console.error('Error generating Excel:', err);
        res.status(500).send('Error generating Excel file');
      }
    });

    app.listen(PORT, () => {
      console.log(`Server running on http://localhost:${PORT}`);
    });
  } catch (error) {
    console.error('Error connecting to MongoDB:', error.message);
    process.exit(1);
  }
})();

// General Error Handling Middleware
app.use((err, req, res, next) => {
  console.error('Unhandled Error:', err.stack);
  res.status(500).send('Internal Server Error');
});



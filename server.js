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
const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/supplier_db'; // MongoDB connection string
const GMAIL_USER = process.env.GMAIL_USER || 'your-email@gmail.com'; // Gmail username
const GMAIL_PASS = process.env.GMAIL_PASS || 'your-password'; // Gmail password
const HEROKU_APP_NAME = process.env.HEROKU_APP_NAME || ''; // Heroku app name for dynamic URL generation

// Check if all necessary environmental variables are defined
if (!MONGO_URI || !GMAIL_USER || !GMAIL_PASS) {
  console.error('Missing required configuration variables. Please set them in the environment or .env file.');
  process.exit(1);
}

// Middleware
app.use(express.urlencoded({ extended: true }));
app.use(express.json()); // To handle JSON requests
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static('public'));

// HTTPS Redirect for Heroku
if (HEROKU_APP_NAME) {
  app.use((req, res, next) => {
    if (req.headers['x-forwarded-proto'] !== 'https') {
      return res.redirect(`https://${req.headers.host}${req.url}`);
    }
    next();
  });
}

// MongoDB Connection with Retry Logic
const connectToDB = async () => {
  let retries = 5;
  while (retries) {
    try {
      const client = await MongoClient.connect(MONGO_URI, {
        useNewUrlParser: true,
        useUnifiedTopology: true,
      });
      console.log('Connected to MongoDB');
      return client.db('supplier_db');
    } catch (err) {
      console.error(`MongoDB connection failed: ${err.message}. Retrying...`);
      retries -= 1;
      await new Promise((res) => setTimeout(res, 5000)); // Wait 5 seconds before retry
    }
  }
  console.error('Failed to connect to MongoDB after multiple retries.');
  process.exit(1);
};

// Application Logic
(async () => {
  console.log(`PORT environment variable: ${PORT}`); // Log the value of PORT
  console.log('Starting server...'); // Indicate server startup process

  const db = await connectToDB();
  const usersCollection = db.collection('users');

  // Routes
  app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
  app.get('/login', (req, res) => res.sendFile(path.join(__dirname, 'login-selection.html')));
  app.get('/supplier/login', (req, res) => res.sendFile(path.join(__dirname, 'supplier-login.html')));
  app.get('/customer/login', (req, res) => res.sendFile(path.join(__dirname, 'customer-login.html')));
  app.get('/signup', (req, res) => res.sendFile(path.join(__dirname, 'signup.html')));
  app.get('/forgot-password', (req, res) => res.sendFile(path.join(__dirname, 'forgot-password.html')));

  // New Route for Supplier Form
  app.get('/supplier_form', (req, res) => {
    res.render('supplier_form'); // Assuming supplier_form.ejs exists in the views folder
  });

  // Health Check Route
  app.get('/health', (req, res) => res.send('Server is running and healthy!'));

  // Signup Route
  app.post('/signup', async (req, res) => {
    const { name, email, companyName, password } = req.body;

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!email || !emailRegex.test(email)) {
      return res.status(400).send('Invalid email address.');
    }
    if (!password || password.length < 8) {
      return res.status(400).send('Password must be at least 8 characters long.');
    }

    const cleanCompanyName = companyName.toLowerCase().replace(/\d+/g, '').trim();
    const collectionName = cleanCompanyName.slice(0, 24);

    try {
      const collections = await db.listCollections().toArray();
      const collectionExists = collections.some((col) => col.name === collectionName);

      if (!collectionExists) {
        await db.createCollection(collectionName);
      }

      const hashedPassword = await bcrypt.hash(password, 10);
      await usersCollection.insertOne({ name, email, companyName, password: hashedPassword });

      const customURL = HEROKU_APP_NAME
        ? `https://${HEROKU_APP_NAME}.herokuapp.com/${collectionName}`
        : `http://www.supplierdb.info/${collectionName}`;

      res.render('signupResponse', { companyName, customURL });
    } catch (error) {
      console.error('Signup error:', error);
      res.status(500).send('Error creating account.');
    }
  });

  // Forgot Password Route
  app.post('/forgot-password', async (req, res) => {
    const { email } = req.body;
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    if (!email || !emailRegex.test(email)) {
      return res.status(400).send('Invalid email address.');
    }

    try {
      const user = await usersCollection.findOne({ email });
      if (!user) {
        return res.status(404).send('Email not registered.');
      }

      const resetToken = crypto.randomBytes(32).toString('hex');
      const hashedToken = crypto.createHash('sha256').update(resetToken).digest('hex');
      const resetTokenExpiry = Date.now() + 3600000;

      await usersCollection.updateOne(
        { email },
        { $set: { resetToken: hashedToken, resetTokenExpiry } }
      );

      const resetURL = HEROKU_APP_NAME
        ? `https://${HEROKU_APP_NAME}.herokuapp.com/reset-password/${resetToken}`
        : `http://localhost:${PORT}/reset-password/${resetToken}`;

      const transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: { user: GMAIL_USER, pass: GMAIL_PASS },
      });

      const mailOptions = {
        from: GMAIL_USER,
        to: email,
        subject: 'Password Reset',
        html: `<p>Click <a href="${resetURL}">here</a> to reset your password.</p>`,
      };

      transporter.sendMail(mailOptions, (err) => {
        if (err) {
          console.error('Email error:', err);
          return res.status(500).send('Error sending reset email.');
        }
        res.send('Reset email sent.');
      });
    } catch (error) {
      console.error('Forgot password error:', error);
      res.status(500).send('Error processing request.');
    }
  });

  // Download Customer Data as Excel
  app.get('/download/customers', async (req, res) => {
    try {
      const customers = await usersCollection.find({}, { projection: { name: 1, email: 1, companyName: 1, companyPhone: 1, mobilePhone: 1, coreServices: 1, website: 1, postcode: 1 } }).toArray();

      const workbook = new ExcelJS.Workbook();
      const sheet = workbook.addWorksheet('Customers');

      sheet.columns = [
        { header: 'Name', key: 'name', width: 20 },
        { header: 'Email', key: 'email', width: 30 },
        { header: 'Company Name', key: 'companyName', width: 25 },
        { header: 'Company Phone', key: 'companyPhone', width: 20 },
        { header: 'Mobile Phone', key: 'mobilePhone', width: 20 },
        { header: 'Core Services', key: 'coreServices', width: 30 },
        { header: 'Website', key: 'website', width: 25 },
        { header: 'Postcode', key: 'postcode', width: 15 },
      ];

      sheet.addRows(customers);

      res.setHeader(
        'Content-Disposition',
        'attachment; filename="customers.xlsx"'
      );
      await workbook.xlsx.write(res);
      res.end();
    } catch (error) {
      console.error('Error exporting customers:', error);
      res.status(500).send('Error exporting customers.');
    }
  });

  // Download Supplier Data as Excel
  app.get('/download/suppliers', async (req, res) => {
    try {
      const suppliers = await db.listCollections().toArray();

      const workbook = new ExcelJS.Workbook();
      const sheet = workbook.addWorksheet('Suppliers');

      sheet.columns = [
        { header: 'Supplier Collection', key: 'name', width: 30 },
      ];

      suppliers.forEach((supplier) => {
        sheet.addRow({ name: supplier.name });
      });

      res.setHeader(
        'Content-Disposition',
        'attachment; filename="suppliers.xlsx"'
      );
      await workbook.xlsx.write(res);
      res.end();
    } catch (error) {
      console.error('Error exporting suppliers:', error);
      res.status(500).send('Error exporting suppliers.');
    }
  });

  app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
    console.log(`Test server connectivity: curl http://localhost:${PORT}/health`);
  });
})();



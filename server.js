const express = require('express');
const bodyParser = require('body-parser');
const { MongoClient } = require('mongodb');
const ExcelJS = require('exceljs');  // Import the ExcelJS module
const crypto = require('crypto');    // Import the crypto module
const nodemailer = require('nodemailer'); // Import nodemailer module
const bcrypt = require('bcryptjs');    // Import bcrypt for password hashing
const PORT = process.env.PORT || 3000;

const app = express();
app.use(bodyParser.urlencoded({ extended: true }));

// Set EJS as the templating engine
app.set('view engine', 'ejs');
app.set('views', __dirname + '/views');

// MongoDB Connection URL
const uri = 'mongodb+srv://webform_user:WebForm@project1.poswy.mongodb.net/supplier_db?retryWrites=true&w=majority';

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

        // Serve the login selection page
        app.get('/login', (req, res) => {
            res.sendFile(__dirname + '/login-selection.html'); // New login selection page
        });

        // Serve the supplier login page
        app.get('/supplier/login', (req, res) => res.sendFile(__dirname + '/supplier-login.html'));

        // Serve the customer login page
        app.get('/customer/login', (req, res) => res.sendFile(__dirname + '/customer-login.html'));

        // Serve the signup page
        app.get('/signup', (req, res) => res.sendFile(__dirname + '/signup.html'));

        // Serve the forgot password page
        app.get('/forgot-password', (req, res) => {
            res.sendFile(__dirname + '/forgot-password.html'); // Serve a form to enter an email address
        });

        // Handle sign-up logic
        app.post('/signup', async (req, res) => {
            const { name, email, companyName, password } = req.body;
            const collectionName = companyName.toLowerCase().replace(/\s+/g, ''); // Generate collection name from company

            try {
                // Create a new collection for the company
                await db.createCollection(collectionName);

                // Insert user information into the 'users' collection
                const hashedPassword = await bcrypt.hash(password, 10); // Hash the password
                await usersCollection.insertOne({ name, email, companyName, password: hashedPassword });

                // Custom URL for the company
                const customURL = `http://localhost:3000/${collectionName}`;

                // Render the response page with the company name and custom URL
                res.render('signupResponse', { companyName, customURL });
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

        // Handle supplier login
        app.post('/supplier/login', async (req, res) => {
            const { companyName, password } = req.body;

            try {
                // Fetch the supplier from the database
                const supplier = await usersCollection.findOne({ companyName });

                // Check if supplier exists and password matches
                if (supplier && await bcrypt.compare(password, supplier.password)) {
                    const downloadLink = `/supplier/download/${companyName}`;
                    res.render('loginResponse', { companyName, downloadLink, userType: 'supplier' }); // Add userType
                } else {
                    res.status(401).send('Invalid credentials. Please try again.');
                }
            } catch (error) {
                console.error('Error logging in:', error);
                res.status(500).send('An error occurred during login. Please try again.');
            }
        });

        // Handle login for customers
        app.post('/customer/login', async (req, res) => {
            const { companyName, password } = req.body;

            try {
                // Fetch the user from the database
                const user = await usersCollection.findOne({ companyName });

                // Check if user exists and password matches
                if (user && await bcrypt.compare(password, user.password)) {
                    const downloadLink = `/download/${companyName}`;
                    res.render('loginResponse', { companyName, downloadLink, userType: 'customer' }); // Add userType
                } else {
                    res.status(401).send('Invalid credentials. Please try again.');
                }
            } catch (error) {
                console.error('Error logging in:', error);
                res.status(500).send('An error occurred during login. Please try again.');
            }
        });

        // Handle form submission for suppliers for a specific company
       app.post('/submit/:company', async (req, res) => {
      console.log('Request body:', req.body); // Log incoming form data
      const companyName = req.params.company.toLowerCase();
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

    try {
        const collection = db.collection(companyName);
        await collection.insertOne(supplierData);
        console.log(`Supplier data saved to ${companyName} collection`);

        // Render the confirmation page with dynamic company branding
        res.render('supplier-submission-confirmation', { companyName });
    } catch (err) {
        console.error('Error inserting data:', err);
        res.status(500).send('Failed to add supplier');
    }
});

        // Route to display all suppliers
        app.get('/suppliers', (req, res) => {
            suppliersCollection.find().toArray()
                .then(results => {
                    res.render('suppliers', { suppliers: results });
                })
                .catch(error => console.error(error));
        });

        // Add the Excel download route for a specific company
        app.get('/download/:company', async (req, res) => {
            const companyName = req.params.company;

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

                // Fetch data from the company's collection in MongoDB
                const collection = db.collection(companyName.toLowerCase().replace(/\s+/g, ''));
                const suppliers = await collection.find().toArray();

                // Add rows with data
                suppliers.forEach(supplier => {
                    worksheet.addRow(supplier);
                });

                // Set response header for Excel file
                res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
                res.setHeader('Content-Disposition', `attachment; filename=${companyName}_suppliers.xlsx`);

                // Write the Excel file to the response
                await workbook.xlsx.write(res);
                res.end();
            } catch (err) {
                console.error('Error generating Excel:', err);
                res.status(500).send('Error generating Excel file');
            }
        });

        // Route to handle password reset request
        app.post('/forgot-password', async (req, res) => {
            const { email } = req.body;

            // Find the user by email
            const user = await usersCollection.findOne({ email });

            if (!user) {
                return res.status(404).send('User with this email does not exist.');
            }

            // Generate a reset token and expiry time (e.g., 1 hour)
            const resetToken = crypto.randomBytes(32).toString('hex');
            const resetTokenExpiry = Date.now() + 3600000; // 1 hour

            // Store token and expiry in the user's record
            await usersCollection.updateOne(
                { email },
                { $set: { resetToken, resetTokenExpiry } }
            );

            // Send reset email with a link to reset the password
            const resetURL = `https://${process.env.PROJECT_DOMAIN}.glitch.me/reset-password/${resetToken}`;
            const transporter = nodemailer.createTransport({
                service: 'gmail',
                auth: {
                    user: 'youremail@gmail.com',
                    pass: 'yourpassword',
                },
            });

            const mailOptions = {
                from: 'youremail@gmail.com',
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
        });

        // Start the server on port 3000
       app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
    })
    .catch(error => console.error(error));

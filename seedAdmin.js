require('dotenv').config();
const mongoose = require('mongoose');
const User = require('./src/models/User');

const seedAdmin = async () => {
    try {
        await mongoose.connect(process.env.MONGODB_URI, {
            useNewUrlParser: true,
            useUnifiedTopology: true,
        });
        console.log('Connected to MongoDB');

        const adminEmail = 'yuri@einsdream.cl';
        const adminPassword = '123456';

        const existingAdmin = await User.findOne({ email: adminEmail });
        if (existingAdmin) {
            console.log('Admin user already exists.');
        } else {
            const adminUser = new User({
                email: adminEmail,
                password: adminPassword,
                role: 'admin',
                consentGiven: true
            });
            await adminUser.save();
            console.log('Admin user created successfully.');
        }

    } catch (error) {
        console.error('Error seeding admin user:', error);
    } finally {
        mongoose.connection.close();
    }
};

seedAdmin();

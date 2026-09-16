import 'dotenv/config';
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import User from './src/models/User.js';

const seedAdmin = async () => {
    try {
        await mongoose.connect(process.env.MONGODB_URI);
        console.log('Connected to MongoDB');

        const adminEmail = process.env.ADMIN_EMAIL || 'yuri@einsdream.cl';
        const adminPassword = process.env.ADMIN_INITIAL_PASSWORD;
        if (!adminPassword) {
            console.error('ADMIN_INITIAL_PASSWORD not configured. Aborting.');
            return;
        }

        const existingAdmin = await User.findOne({ email: adminEmail });
        if (existingAdmin) {
            console.log('Admin user already exists.');
        } else {
            const hashedPassword = await bcrypt.hash(adminPassword, 12);
            const adminUser = new User({
                email: adminEmail,
                password: hashedPassword,
                role: 'admin',
                consentGiven: true
            });
            await adminUser.save();
            console.log('Admin user created successfully with bcrypt hash.');
        }

    } catch (error) {
        console.error('Error seeding admin user:', error);
    } finally {
        mongoose.connection.close();
    }
};

seedAdmin();

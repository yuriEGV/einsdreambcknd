import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || 'einsdream_super_secret_jwt_key_2026';

export default (req, res, next) => {
    const authHeader = req.headers.authorization;
    let token = null;

    if (authHeader && authHeader.startsWith('Bearer ')) {
        token = authHeader.split(' ')[1];
    } else if (authHeader) {
        token = authHeader;
    } else if (req.query && req.query.token) {
        token = req.query.token;
    } else if (req.headers['x-access-token']) {
        token = req.headers['x-access-token'];
    }

    if (!token) {
        return res.status(401).json({ message: 'Authorization token missing' });
    }

    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        req.user = decoded;
        next();
    } catch (error) {
        res.status(401).json({ message: 'Invalid or expired token', error: error.message });
    }
};

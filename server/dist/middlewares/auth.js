import * as Sentry from "@sentry/node";
export const protect = async (req, res, next) => {
    try {
        const { userId } = req.auth();
        if (!userId) {
            return res.status(401).json({ message: 'Unauthorized' });
        }
        next();
    }
    catch (error) {
        Sentry.captureException(error);
        res.status(401).json({ message: error.code || error.message });
    }
};

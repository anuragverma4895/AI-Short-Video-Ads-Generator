import "./configs/instrument.js"
import express, { Request, Response } from 'express';
import cors from 'cors';
import 'dotenv/config'
import { clerkMiddleware } from '@clerk/express'
import clerkWebhooks  from './controllers/clerk.js';
import * as Sentry from "@sentry/node"
import userRouter from "./routes/userRoutes.js";
import projectRouter from "./routes/projectRoutes.js";

import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();


const PORT = process.env.PORT || 5000;
const NODE_ENV = process.env.NODE_ENV || 'development';

const allowedOrigins = process.env.ALLOWED_ORIGINS 
    ? process.env.ALLOWED_ORIGINS.split(',') 
    : ['http://localhost:5173'];

app.use(cors({
    origin: NODE_ENV === 'production' ? allowedOrigins : true,
    credentials: true,
}));

app.post('/api/clerk', express.raw({ type: 'application/json' }), clerkWebhooks);

app.use(express.json());
app.use(clerkMiddleware());


app.get('/api', (req: Request, res: Response) => {
    res.send('API is Live!');
});

app.get("/debug-sentry", function mainHandler(req, res) {
  throw new Error("My first Sentry error!");
});

app.use('/api/user', userRouter);
app.use('/api/project', projectRouter);

// The error handler must be registered before any other error middleware and after all contollers
Sentry.setupExpressErrorHandler(app);

// Serve Static Files in Production
if (NODE_ENV === "production") {
  const distPath = path.join(__dirname, "../../client/dist");
  app.use(express.static(distPath));

  app.use((req: Request, res: Response) => {



    res.sendFile(path.resolve(distPath, "index.html"));
  });
}

app.listen(PORT, () => {
    console.log(`Server is running in ${NODE_ENV} mode at port ${PORT}`);
});
import * as Sentry from "@sentry/node";
Sentry.init({
    dsn: process.env.SENTRY_DSN || "https://4ae386d8f2b0bc6792263ea95c2a2367@o4511053052444672.ingest.us.sentry.io/4511053058080768",
    // Setting this option to true will send default PII data to Sentry.
    // For example, automatic IP address collection on events
    sendDefaultPii: true,
});

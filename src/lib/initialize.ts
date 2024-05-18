import logger from './logger.js';


process.setMaxListeners(Infinity);

process.on("uncaughtException", (err, origin) => {
    logger.error(`An unhandled error occurred: ${origin}`, err);
});

process.on("unhandledRejection", (_, promise) => {
    promise.catch(err => logger.error("An unhandled rejection occurred:", err));
});

process.on("warning", warning => logger.warn("System warning: ", warning));

process.on("exit", () => {
    logger.info("Service exit");
    logger.footer();
});

process.on("SIGTERM", () => {
    logger.warn("received kill signal");
    process.exit(2);
});

process.on("SIGINT", () => {
    process.exit(0);
});

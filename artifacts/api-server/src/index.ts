import app from "./app";
import { logger } from "./lib/logger";
import { seedConfiguredOwner } from './lib/owner-bootstrap';

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

try {
  await seedConfiguredOwner();
} catch (error) {
  logger.error({ errorType: error instanceof Error ? error.name : 'UnknownError' }, 'Could not initialize owner access. Check Clerk, ALIGN_OWNER_EMAIL, and database configuration.');
  process.exit(1);
}

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");
});

// Must be the FIRST import in main.ts: OpenTelemetry instrumentation has to be
// registered before express/http are loaded. dotenv is loaded here too because
// this file runs before main.ts's own `dotenv/config`.
import 'dotenv/config';
import { initSentry } from './observability/sentry';

initSentry();

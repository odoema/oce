# OCE Test Plan

Before production sending, test at minimum:

- email normalization and validation;
- Uganda phone normalization;
- duplicate detection;
- consent filtering;
- suppression filtering;
- segmentation operators;
- batch sizing at 250;
- weekend and holiday blocking;
- pause/resume behavior;
- queue idempotency;
- unsubscribe processing;
- bounce suppression;
- provider rate-limit handling;
- retry and error logging;
- campaign auditability.

Use synthetic test contacts only.

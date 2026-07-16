# Roadmap

## Direct coverage review

The current test-review feature decides whether the pull-request patch likely
requires tests to be added or updated. It does not prove that existing tests cover
the changed behavior.

A future direct-coverage review should retrieve likely related tests from the base
branch, provide those tests and the changed implementation to the reviewer, and
report an evidence-backed coverage assessment. It will need repository-content read
access, bounded file selection, and a clear distinction between “coverage appears
present” and “coverage could not be established.” It must remain advisory unless a
repository explicitly opts into enforcement.

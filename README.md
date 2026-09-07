# Course Data Retrieval from Behestan

Behestan does not provide a documented public API for retrieving the complete list of available courses. To implement course synchronization, the network requests used by Behestan's course report page were examined. The report page retrieves its data from an internal service as a JSON response containing the raw report data.

The application sends the equivalent report request from the server using a valid and temporary Behestan session. Session values are used only for the current request and are not stored in the database or application files.

The Behestan response contains the report data in XML format. The application validates the JSON response, extracts the XML report, normalizes Persian and Arabic characters and digits, and parses course details, professors, capacity, class meetings, locations, and exam schedules.

Each course is identified by its term, course code, and group number. The parsed records are synchronized with SQL Server inside a database transaction. Existing meetings, professors, and exam information are replaced with the latest values. Courses that are no longer present in the report are marked as inactive instead of being deleted so their identifiers remain stable.

This integration depends on Behestan's current internal report format. Changes to the service or its response structure may require updates to the parser. A valid and authorized Behestan session is required to retrieve course information.

This project is independent and is not officially affiliated with Shahid Beheshti University or the Behestan educational system.

# Public Release Notice

## This is not the final or deployed release. It is a public release preserved for future developers and maintainers.

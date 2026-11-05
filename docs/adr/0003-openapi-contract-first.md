# The OpenAPI file generates the client and the validators

`lib/api-spec/openapi.yaml` is the one definition of the API. Orval generates the React Query hooks that the dashboard uses and the Zod validators that the server uses. The server and the dashboard therefore cannot silently disagree about a response, and the dashboard's types follow the API without manual work.

The original project recorded no reasons for this choice, so these reasons are inferred from the code.

## Consequences

- Every API change starts in the YAML file and needs a code generation run.
- The `generated` folders must never be edited by hand.
- The server validates its responses, and Zod removes unknown fields. A field that a route returns but the YAML does not define disappears with no error.

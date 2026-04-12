import { withSerwist } from "@serwist/turbopack";

export default withSerwist({
  reactCompiler: true,
  allowedDevOrigins: ['http://localhost:3000', 'http://127.0.0.1:3000'],
});

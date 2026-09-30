Deploy my existing **VEXON** project to **Render Free** for tomorrow’s college test with approximately **100 students + 3 faculty**.

First inspect the entire repository and determine the correct deployment configuration from the existing code. **Do not rewrite or change the application architecture unnecessarily.**

Deployment requirements:

* Frontend: React + Vite
* Backend: Node.js + Express + Socket.IO
* Database: **MongoDB Atlas** — do NOT deploy MongoDB on Render
* No Docker
* Use the existing GitHub repository/branch
* Deploy the backend as a Render Web Service
* Deploy the frontend appropriately on Render
* Configure all required environment variables
* Ensure frontend API URL points to the deployed backend
* Ensure Socket.IO/CORS works correctly
* Ensure the backend uses Render's `PORT` and binds correctly for production
* Never expose MongoDB URI, JWT secrets, Groq API key, or other secrets in frontend code
* Do not modify features or database schema unless required for deployment.

Before making changes, inspect `client`, `server`, `package.json` files, environment configuration, API configuration, Socket.IO configuration, and existing `render.yaml` if present.

Then give me a **step-by-step Render deployment guide** showing exactly:

1. What to select in Render
2. Root Directory
3. Build Command
4. Start Command
5. Environment Variables
6. MongoDB Atlas configuration
7. Frontend API URL configuration
8. CORS/Socket.IO configuration
9. How to deploy
10. How to verify the deployed website

Use the **Render Free plan** for this temporary test. Do not deploy the mobile app yet.

After deployment configuration is ready, run local/build checks and report any errors that must be fixed before tomorrow's test.

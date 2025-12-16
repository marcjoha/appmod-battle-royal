# AppMod Battle Royal

This is a Kahoot-clone built for people who care about Google Cloud App Modernization products.

The Gemini API key is used for generating questions. The host password is optional, but protects the app's host site where you kick off game play (and use the Gemini API for generating questions).

Originally vibe coded in Google AI studio.

## Run Locally

**Prerequisites:**  Node.js

1. Install dependencies:
   `npm install`
2. Set the `GEMINI_API_KEY` and `VITE_HOST_PASSWORD` in `.env.local`
3. Run the app:
   `npm run dev`

## Deploy to Cloud Run

**Prerequisites:** Google Cloud SDK (`gcloud`)

1. Ensure you are authenticated with Google Cloud:
   `gcloud auth login`
2. Set the `GEMINI_API_KEY` and `VITE_HOST_PASSWORD` in `.env.local`
3. Run the deployment script:
   `./deploy.sh`


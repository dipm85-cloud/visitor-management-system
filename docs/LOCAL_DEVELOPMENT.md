# Local Development

Milestone: `NextGen-004`

Run the application through a local HTTP server during development. Do not open it directly with a `file://` URL, because native ES modules require the application to be served over HTTP.

## Prerequisite

Install the current Node.js LTS release if Node.js is not already installed.

## Start the Application

An initial `npm install` is not required. From the project root, run:

```powershell
npm start
```

The command uses `npx serve .` and may prompt to download `serve` the first time it runs. Open the local URL shown in the terminal, such as `http://localhost:3000`.

For the same local server workflow, you can alternatively run:

```powershell
npm run dev
```

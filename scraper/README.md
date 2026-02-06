# Facebook Scraper Microservice

A lightweight Node.js service that uses Playwright to scrape Facebook posts and extract images.

## Setup

```bash
npm install
npx playwright install chromium
```

## Run locally

```bash
npm start
# or for development
npm run dev
```

## API Endpoint

### POST /scrape

Request:
```json
{
  "url": "https://www.facebook.com/share/p/xxx/"
}
```

Response:
```json
{
  "success": true,
  "data": {
    "text": "Post content...",
    "author": "Author Name",
    "images": [
      "https://scontent.xxx.fbcdn.net/..."
    ]
  }
}
```

## Deployment

### Fly.io (recommended)
```bash
fly launch
fly deploy
```

### Railway
Connect your repo and it will auto-deploy.

### Docker
```bash
docker build -t fb-scraper .
docker run -p 3001:3001 fb-scraper
```

## Environment Variables

- `PORT` - Server port (default: 3001)
- `API_KEY` - Optional API key for authentication

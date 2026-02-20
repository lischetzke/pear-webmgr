# ytm-webmgmt

Web remote control for [YouTube Music Desktop](https://github.com/pear-devs/pear-desktop) (pear-desktop).

## Prerequisites

- Node.js >= 18
- pear-desktop running with the **API Server** plugin enabled (port 26538)
- API Server auth strategy set to **NONE** (in pear-desktop settings)

## Setup

```bash
npm install
npm start
```

Open the URL printed in the console from any device on the same network.

## Configuration

| Env Variable | Default     | Description                                |
|-------------|-------------|--------------------------------------------|
| `PORT`      | `3000`      | Port the web remote listens on             |
| `YTM_HOST`  | `localhost` | Hostname/IP where pear-desktop is running  |
| `YTM_PORT`  | `26538`     | pear-desktop API server port               |

Example running against a remote machine:

```bash
YTM_HOST=192.168.1.50 npm start
```

## Features

- Currently playing: title, artist, album art
- Play / Pause, Next, Previous
- Volume slider
- Progress bar with elapsed / total time
- Queue management (view, reorder, remove)
- Add songs by YouTube/YT Music URL
- Search and add songs directly

## Disclaimer

This project was fully developed by AI.

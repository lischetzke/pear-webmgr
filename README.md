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

| Env Variable    | Default       | Description                                                  |
|----------------|---------------|--------------------------------------------------------------|
| `PORT`         | `3001`        | HTTP port used when `USE_SSL=false`                         |
| `PORT_SSL`     | `PORT + 1`    | HTTPS port used when `USE_SSL=true`                         |
| `YTM_HOST`     | `localhost`   | Hostname/IP where pear-desktop is running                   |
| `YTM_PORT`     | `26538`       | pear-desktop API server port                                |
| `USE_SSL`      | `false`       | Enables HTTPS when set to `true`                            |
| `SSL_KEY_PATH` | _(required)_  | Path to TLS private key file (required when `USE_SSL=true`) |
| `SSL_CERT_PATH`| _(required)_  | Path to TLS certificate file (required when `USE_SSL=true`) |

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

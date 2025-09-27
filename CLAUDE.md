# Claude Development Notes

## Package Manager
- Use `yarn` instead of `npm` for all package management tasks

## Development Commands
- Install dependencies: `yarn install`
- Add packages: `yarn add <package-name>`
- Start server: `yarn start` or `./start-server.sh`
- Development mode: `yarn dev`

## Server Information
- Audio classification server runs on port 3001
- WebSocket endpoint: `ws://localhost:3001`
- Test endpoint: `http://localhost:3001/test`
- Health check: `http://localhost:3001/health`
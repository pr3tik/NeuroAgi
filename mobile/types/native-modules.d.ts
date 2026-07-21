// native-modules.d.ts — ambient shim for optional native modules the app
// references but hasn't installed yet.
//
// `react-native-background-fetch` is used only by services/brain-signal-service.ts
// (the "ambient signal layer" — scaffolding, not yet wired into the app). Declaring
// it here lets the project typecheck without pulling in the native dependency and a
// rebuild. When the signal layer actually ships: `npm i react-native-background-fetch`
// (it bundles its own types) and delete this declaration.
declare module 'react-native-background-fetch';

// index.jsx — React entry point. Mounts App into #root.
// /card is a standalone public page — rendered without AppProvider/Supabase
//
// NOTE: StrictMode is intentionally NOT used. In dev it double-invokes effects,
// which double-subscribes the Supabase Realtime channels (global presence, the
// per-room presence channel, lobby, etc.). The room channel then crashes with
// "cannot add `presence` callbacks ... after subscribe()" because Supabase reuses
// the still-subscribed channel for that topic. Production never double-invokes, so
// rendering without StrictMode makes dev behave like prod.
import ReactDOM    from "react-dom/client";
import "./index.css";

if (window.location.pathname === "/card") {
  // /card is retired — no public access. Bounce to the landing page.
  window.location.replace("/");
} else {
  Promise.all([
    import("./App"),
    import("./context/AppContext"),
  ]).then(([{ default: App }, { AppProvider }]) => {
    ReactDOM.createRoot(document.getElementById("root")).render(
      <AppProvider>
        <App />
      </AppProvider>
    );
  });
}

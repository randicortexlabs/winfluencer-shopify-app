import { redirect } from "react-router";
import styles from "./styles.module.css";

export const loader = async ({ request }) => {
  const url = new URL(request.url);

  if (url.searchParams.get("shop")) {
    throw redirect(`/app?${url.searchParams.toString()}`);
  }

  return {};
};

export default function App() {
  return (
    <div className={styles.index}>
      <div className={styles.content}>
        <h1 className={styles.heading}>Winfluencer Creator Analytics</h1>
        <p className={styles.text}>
          Track every influencer click, cart, and sale — automatically. Install
          the app from the Shopify App Store to get started.
        </p>
        <ul className={styles.list}>
          <li>
            <strong>Influencer attribution</strong>. Generate unique tracking
            links for each influencer and see exactly which clicks convert to
            sales.
          </li>
          <li>
            <strong>Real-time analytics</strong>. Live conversion funnel —
            visitors, add-to-cart, checkout, and purchases — all in one
            dashboard.
          </li>
          <li>
            <strong>Multi-touch journey tracking</strong>. See every touchpoint
            in a customer&apos;s path from influencer click to purchase.
          </li>
        </ul>
      </div>
    </div>
  );
}

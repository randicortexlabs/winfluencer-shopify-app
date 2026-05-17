import { redirect, Form, useLoaderData } from "react-router";
import styles from "./styles.module.css";

export const loader = async ({ request }) => {
  const { login } = await import("../../shopify.server");
  const url = new URL(request.url);

  if (url.searchParams.get("shop")) {
    throw redirect(`/app?${url.searchParams.toString()}`);
  }

  return { showForm: Boolean(login) };
};

export default function App() {
  const { showForm } = useLoaderData();

  return (
    <div className={styles.index}>
      <div className={styles.content}>
        <h1 className={styles.heading}>Winfluencer Creator Analytics</h1>
        <p className={styles.text}>
          Track every influencer click, cart, and sale — automatically. Install
          the app from the Shopify App Store to get started.
        </p>
        {showForm && (
          <Form className={styles.form} method="post" action="/auth/login">
            <label className={styles.label}>
              <span>Shop domain</span>
              <input className={styles.input} type="text" name="shop" />
              <span>e.g: my-shop-domain.myshopify.com</span>
            </label>
            <button className={styles.button} type="submit">
              Log in
            </button>
          </Form>
        )}
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

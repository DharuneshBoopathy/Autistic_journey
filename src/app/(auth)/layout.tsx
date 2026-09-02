import styles from '@/components/paper.module.css';

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className={styles.authShell}>
      <main id="main" className={styles.authInner}>
        <div className={styles.brand}>
          <h1 className={styles.brandName}>The Autistic Journey</h1>
          <p className={styles.brandTag}>A private archive</p>
        </div>
        {children}
      </main>
    </div>
  );
}

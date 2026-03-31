import React from 'react';

export default function AppFooter() {
  return (
    <footer className="app-footer">
      <span>© {new Date().getFullYear()} BugHunter.AI. All rights reserved.</span>
      <nav className="app-footer__links" aria-label="Legal">
        <a href="#" className="footer-link">Cookie policy</a>
        <a href="#" className="footer-link">Terms of use</a>
        <a href="#" className="footer-link">Privacy</a>
      </nav>
    </footer>
  );
}

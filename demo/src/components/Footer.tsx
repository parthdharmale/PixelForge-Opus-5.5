const columns = [
  { heading: 'Product', links: ['Features', 'Pricing', 'Changelog', 'Status'] },
  { heading: 'Developers', links: ['Documentation', 'API reference', 'CLI', 'Examples'] },
  { heading: 'Company', links: ['About', 'Blog', 'Careers', 'Contact'] },
];

export function Footer() {
  return (
    <footer className="site-footer">
      <div className="container">
        <div className="footer-grid">
          <div>
            <div className="footer-brand">Nimbus</div>
            <p>The edge platform for modern teams.</p>
          </div>
          {columns.map((col) => (
            <div key={col.heading}>
              <h4 className="footer-heading">{col.heading}</h4>
              <ul className="footer-links">
                {col.links.map((link) => (
                  <li key={link}>
                    <a href="#top">{link}</a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <div className="footer-bottom">
          <span>© 2026 Nimbus Labs, Inc.</span>
          <span>Made for the edge.</span>
        </div>
      </div>
    </footer>
  );
}

import { Component, createElement as h } from 'react';

// Lazy chunks can disappear between deployments. Keep a recoverable screen
// instead of unmounting the entire storefront. Never reload automatically.
export default class AppErrorBoundary extends Component {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch() {
    // Do not log error messages, URLs, account details or recovery tokens.
    console.error('storefront_render_failed');
  }
  render() {
    if (!this.state.failed) return this.props.children;
    return h('main', { className: 'section container narrow', role: 'alert' },
      h('h1', null, 'Let’s reopen this page'),
      h('p', null, 'The page could not finish loading. This can happen after a site update or a connection interruption.'),
      h('p', null, 'If you were submitting an order or payment, check your order history before trying again. Unsaved form entries may need to be entered again.'),
      h('button', { type: 'button', className: 'button button-gold', onClick: () => window.location.reload() }, 'Reload page'),
      h('p', null, h('a', { href: '/account?tab=orders' }, 'Check my orders'), ' · ', h('a', { href: '/support' }, 'Contact support')),
    );
  }
}

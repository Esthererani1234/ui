import test from 'node:test';
import assert from 'node:assert/strict';
import {renderToStaticMarkup} from 'react-dom/server';
import AppErrorBoundary from '../src/components/AppErrorBoundary.js';
test('render failure offers explicit recovery without leaking internal error or reloading',()=>{
 const boundary=new AppErrorBoundary({children:'working page'});
 assert.equal(boundary.render(),'working page');
 boundary.state=AppErrorBoundary.getDerivedStateFromError(new Error('private token internal path'));
 const html=renderToStaticMarkup(boundary.render());
 assert.match(html,/Reload page/);assert.match(html,/Check my orders/);
 assert.match(html,/role="alert"/);assert.doesNotMatch(html,/private token|internal path/);
});

import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { Provider } from 'react-redux';
import { store } from './app/store';
import App from './App';
import { api } from './services/api';
import { createErrorReporter, setErrorReporter } from './services/errorReporter';
import './index.css';

// Report uncaught errors to the Super Admin SOC (signed-in users only).
const reporter = createErrorReporter({
  send: (body) => store.dispatch(api.endpoints.reportClientError.initiate(body)).unwrap(),
  isSignedIn: () => Boolean(store.getState().auth.accessToken),
  getRoute: () => window.location.pathname,
});
setErrorReporter(reporter);
reporter.install(window);

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <Provider store={store}>
      <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <App />
      </BrowserRouter>
    </Provider>
  </React.StrictMode>
);

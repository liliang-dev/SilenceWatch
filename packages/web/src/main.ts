import { bootstrapApplication } from '@angular/platform-browser';
import { appConfig } from './app/app.config';
import { AppComponent } from './app/app.component';

bootstrapApplication(AppComponent, appConfig).catch((error: unknown) => {
  // Nothing rendered: the only place left to say so is the console.
  console.error('SilenceWatch failed to start', error);
});

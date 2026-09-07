declare module 'hpp' {
  import { RequestHandler } from 'express';
  function hpp(options?: { whitelist?: string[] }): RequestHandler;
  export = hpp;
}

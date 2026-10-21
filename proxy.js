import { next } from '@vercel/functions';
import { accessResponse } from './server/access.js';

export default function proxy(request) {
  const blocked=accessResponse(request);
  if(blocked) return blocked;
  const response=next();
  response.headers.set('Cache-Control','private, no-store');
  return response;
}

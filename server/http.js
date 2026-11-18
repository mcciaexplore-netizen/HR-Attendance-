export const httpErr = (status, message, extra) => Object.assign(new Error(message), { status, extra });
export const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

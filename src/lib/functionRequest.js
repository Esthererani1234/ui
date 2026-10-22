// FunctionsHttpError stores the server's safe error body in its Response context.
// Surface that message rather than an opaque non-2xx transport error.
export async function invokeFunction(client, name, body, options = {}) {
  const {data,error}=await client.functions.invoke(name,{body,...options});
  if(error || data?.error) {
    const payload=error?.context?.clone ? await error.context.clone().json().catch(()=>({})) : {};
    throw Object.assign(new Error(data?.error || payload?.error || "The request could not be completed. Please try again."),{status:error?.context?.status || 500});
  }
  return data;
}

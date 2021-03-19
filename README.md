
BaseKoa class with typescript decorators for routing based on [koa](https://www.npmjs.com/package/koa) and [@koa/router](https://www.npmjs.com/package/@koa/router)


```ts
import Koa, { DefaultContext, DefaultState } from 'koa';
import { BaseRouter, routeGet } from '@backlib/koa';

//// EXAMPLE - BaseRouter for class/decorator style API
class Hello3 extends BaseRouter<DefaultState, DefaultContext>{
	#count = 0;

	@routeGet('hello3')
	async hello(ctx: DefaultContext) {
		this.#count++;
		ctx.body = {
			message: `Hello3 from server ${this.#count}`
		}
	}
}

async function main() {

	const app = new Koa();

	const hello3 = new Hello3('/api/');
	app.use(hello3.middleware());   
    
	app.listen(8080);    
}

// Now http://localhost:8080/api/hello3 will return {message: "Hello3 from server ..."}
```


- **Typed** Build with typescript for typescript.
- **Modern** Node.js 14 and above, compiled with native class fields and null coalescing native support. 
- **Minimalist** Not a framework, just some libs that can be assembled into an application infrastructure code.
- **PromiseAsync/Await centric** Use Promise/async/await patterns for all async calls. 
- **Web Async** Web request utilities based on [koajs](https://koajs.com/) over express as it is a modern rewrite of more or less the same API with backed in support for Promise/async/await (simplify many of the usecases)


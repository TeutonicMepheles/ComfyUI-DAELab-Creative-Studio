declare const jsonata: (expression: string) => { evaluate(context: unknown): Promise<unknown> };
export default jsonata;

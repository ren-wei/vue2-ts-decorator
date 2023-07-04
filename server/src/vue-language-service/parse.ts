import * as ts from "typescript";

/** 解析 Vue 组件，获取 vue 组成部分 */
export function parseComponent(component: ts.ClassDeclaration | undefined): VueComponent {
    // 收集组件 model, props, data, computed 和 method
    let model = null as ts.PropertyDeclaration | null;
    const props: ts.PropertyDeclaration[] = [];
    const computedProps: ts.GetAccessorDeclaration[] = [];
    const datas: ts.PropertyDeclaration[] = [];
    const methods: ts.MethodDeclaration[] = [];
    if (component) {
        component.members.forEach(member => {
            if (member.kind === ts.SyntaxKind.PropertyDeclaration) {
                const property = member as ts.PropertyDeclaration;
                // 带有装饰器的属性是 model 或 props
                const decorators = (property.modifiers || []).filter(modifier => modifier.kind === ts.SyntaxKind.Decorator) as ts.Decorator[];
                if (decorators.length) {
                    decorators.forEach(decorator => {
                        if (decorator.expression.kind === ts.SyntaxKind.CallExpression) {
                            const callExpression = decorator.expression as ts.CallExpression;
                            if (callExpression.expression.kind === ts.SyntaxKind.Identifier) {
                                const identifier = callExpression.expression as ts.Identifier;
                                if (identifier.escapedText === "Model") {
                                    model = property;
                                } else if (identifier.escapedText === "Prop") {
                                    props.push(property);
                                }
                            }
                        }
                    });
                } else {
                    datas.push(property);
                }
            } else if (member.kind === ts.SyntaxKind.GetAccessor) {
                computedProps.push(member as ts.GetAccessorDeclaration);
            } else if (member.kind === ts.SyntaxKind.MethodDeclaration) {
                methods.push(member as ts.MethodDeclaration);
            }
        });
    }
    return { model, props, computedProps, datas, methods };
}

export interface VueComponent {
	model: ts.PropertyDeclaration | null;
    props: ts.PropertyDeclaration[];
    computedProps: ts.GetAccessorDeclaration[];
    datas: ts.PropertyDeclaration[];
    methods: ts.MethodDeclaration[];
}

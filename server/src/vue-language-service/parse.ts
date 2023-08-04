import * as path from "path";
import { existsSync } from "fs";
import * as ts from "typescript";
import { VueComponent, VueModel, VueProp } from "./component";
import { getMarkdownFromJsDoc } from "./tools";

/** 解析 Vue 组件，获取 vue 组成部分 */
export function parseComponent(sourceFile: ts.SourceFile): VueComponent {
    // 找到组件类
    const component = sourceFile.statements.find(isVueClassStatement) as ts.ClassDeclaration;
    // 收集组件 name, jsDocComment, model, props, data, computed 和 method
    let name = "default";
    let jsDocComment: ts.JSDoc[] = [];
    let modelProperty = null as ts.PropertyDeclaration | null;
    let propertyList: ts.PropertyDeclaration[] = [];
    if (component) {
        if (component.name) {
            name = component.name.escapedText.toString();
        }
        jsDocComment = (component as ts.ClassDeclaration & { jsDoc?: ts.JSDoc[] }).jsDoc || [];
        modelProperty = filterProperty(component.members || [], "Model")[0] || null;
        propertyList = filterProperty(component.members || [], "Prop");
    }
    const props = propertyList.map(getVueProp);
    const model = getVueModel(modelProperty);
    return { uri: sourceFile.fileName, name, jsDocComment: getMarkdownFromJsDoc(jsDocComment), model, props };
}

/**
 * 获取注册的组件
 * @param sourceFile 源文件
 * @param rootPath 项目根路径
 * @param compilerOptions 编译选项
 * @returns 包含组件名和组件路径的列表。组件路径如果是别名，会被解析成绝对路径
 */
export function getComponentsPath(sourceFile: ts.SourceFile, rootPath: string, compilerOptions: ts.CompilerOptions): { name: string, path: string }[] {
    // 收集注册的组件
    const importComponents: Record<string, string> = {}; // [name]: path
    const getPath = parseAliasPath(rootPath, compilerOptions);
    sourceFile.statements
        .forEach(s => {
            if (ts.isImportDeclaration(s) && ts.isStringLiteral(s.moduleSpecifier)) {
                if (s.moduleSpecifier.text.endsWith(".vue")) {
                    const name = s.importClause?.name?.escapedText.toString();
                    if (name) {
                        importComponents[name] = getPath(s.moduleSpecifier.text);
                    }
                }
            }
        });
    const component = sourceFile.statements.find(isVueClassStatement) as ts.ClassDeclaration;
    if (!component) {
        return [];
    }
    const decorator = component.modifiers?.find(m => ts.isDecorator(m)) as ts.Decorator;
    if (!decorator) {
        return [];
    }
    const components: { name: string, path: string }[] = [];
    const params = getDecoratorArguments(decorator)[0];
    if (params && ts.isObjectLiteralExpression(params)) {
        const componentsDeclaration = getObjectLiteralExpressionValue(params, "components");
        if (componentsDeclaration && ts.isObjectLiteralExpression(componentsDeclaration)) {
            componentsDeclaration.properties.forEach(property => {
                if (ts.isShorthandPropertyAssignment(property)) {
                    const name = property.name.escapedText.toString();
                    const path = importComponents[name];
                    if (path) {
                        components.push({ name, path });
                    }
                }
            });
        }
    }
    return components;
}

/** 是否是 vue 组件类声明 */
function isVueClassStatement(statement: ts.Statement): boolean {
    if (ts.isClassDeclaration(statement)) {
        return statement.modifiers?.some(v => v.kind === ts.SyntaxKind.DefaultKeyword) || false;
    }
    return false;
}

/** 过滤出需要的属性 */
function filterProperty(members: ts.NodeArray<ts.ClassElement>, decoratorName: string) {
    return members.filter(member => {
        if (ts.isPropertyDeclaration(member)) {
            const property = member;
            // 找到装饰器
            const decorators = (property.modifiers || [])
                .filter(modifier => ts.isDecorator(modifier)) as ts.Decorator[];
            if (decorators.length) {
                // 是否存在与提供的名称相等的装饰器
                return decorators.some(decorator => {
                    if (decorator.expression.kind === ts.SyntaxKind.CallExpression) {
                        const callExpression = decorator.expression as ts.CallExpression;
                        if (callExpression.expression.kind === ts.SyntaxKind.Identifier) {
                            const identifier = callExpression.expression as ts.Identifier;
                            return identifier.escapedText === decoratorName;
                        }
                    }
                });
            }
        }
        return false;
    }) as ts.PropertyDeclaration[];
}

function getVueProp(property: ts.PropertyDeclaration): VueProp {
    let name = "";
    if (ts.isIdentifier(property.name)) {
        name = property.name.escapedText.toString();
    }
    let type = "unknown";
    let required: boolean | "unknown" = false;
    const decorator = property.modifiers?.find(v => v.kind === ts.SyntaxKind.Decorator) as ts.Decorator;
    const params = getDecoratorArguments(decorator)[0];
    if (params && ts.isObjectLiteralExpression(params)) {
        const typeParam = findPropertyAssignment(params, "type");
        if (typeParam) {
            if (ts.isIdentifier(typeParam.initializer)) {
                type = typeParam.initializer.escapedText.toString();
            }
        }
        const requiredParam = findPropertyAssignment(params, "required");
        if (requiredParam) {
            if (requiredParam.initializer.kind === ts.SyntaxKind.TrueKeyword) {
                required = true;
            } else if (requiredParam.initializer.kind === ts.SyntaxKind.FalseKeyword) {
                required = false;
            } else {
                required = "unknown";
            }
        }
    }
    const jsDocComment = ((property as ts.PropertyDeclaration & { jsDoc?: ts.JSDoc[] }).jsDoc || []);
    return { name, type, required, jsDocComment: getMarkdownFromJsDoc(jsDocComment) };
}

function getVueModel(modelProperty: ts.PropertyDeclaration | null): VueModel | null {
    if (!modelProperty) {
        return null;
    }
    let event = "";
    const decorator = modelProperty.modifiers?.find(v => v.kind === ts.SyntaxKind.Decorator) as ts.Decorator;
    const eventParam = getDecoratorArguments(decorator)[0];
    if (eventParam && ts.isStringLiteral(eventParam)) {
        event = eventParam.text;
    }
    return { event, ...getVueProp(modelProperty) };
}

/** 获取装饰器函数的参数 */
function getDecoratorArguments(decorator: ts.Decorator): ts.Expression[] {
    if (decorator && ts.isCallExpression(decorator.expression)) {
        return [...decorator.expression.arguments];
    }
    return [];
}

/** 从对象字面量表达式中获取对应 key 的属性 */
function findPropertyAssignment(params: ts.ObjectLiteralExpression, key: string) {
    return params.properties.find(p => ts.isPropertyAssignment(p) && p.name && ts.isIdentifier(p.name) && p.name.escapedText.toString() === key) as ts.PropertyAssignment | undefined;
}

/** 获取对象字面量的key对应的值 */
function getObjectLiteralExpressionValue(objectLiteral: ts.ObjectLiteralExpression, key: string) {
    const componentsProperty = objectLiteral.properties.find(p => {
        if (p.name && ts.isIdentifier(p.name)) {
            return p.name.escapedText.toString() === key;
        }
        return false;
    });
    if (componentsProperty && ts.isPropertyAssignment(componentsProperty)) {
        return componentsProperty.initializer;
    }
    return null;
}

/** 解析路径别名 */
function parseAliasPath(rootPath: string, compilerOptions: ts.CompilerOptions) {
    const baseUrl = compilerOptions.baseUrl || ".";
    const paths = compilerOptions.paths || {};
    const mapping = Object.fromEntries(Object.entries(paths).map(([alias, list]) => {
        // 转化为相对路径
        list = list.map(item => item.startsWith(".") ? item : `./${item}`);
        // 相对路径转换为绝对路径
        list = list.map(item => path.resolve(rootPath, baseUrl, item));
        // 去掉末尾星号
        list = list.map(item => item.replace(/\*$/, ""));
        return [alias.replace(/\*$/, ""), list];
    }));
    return (rawPath: string) => {
        const alias = Object.keys(mapping).find(alias => rawPath.startsWith(alias));
        if (!alias) {
            return rawPath;
        }
        const list = mapping[alias];
        for (let i = 0; i < list.length; i++) {
            const item = list[i];
            const newPath = `${item}${rawPath.slice(alias.length)}`;
            if (existsSync(newPath)) {
                return newPath;
            }
        }
        return rawPath;
    };
}

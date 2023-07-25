/* eslint-disable */

/** 外部组件 */
class HelloWorld {
    /** 外部组件的消息 */
    msg!: string;
}

/**
```html
<template>
  <div id="app">
    <img alt="Vue logo" src="./assets/logo.png" />
    <HelloWorld :msg="msg">prev{{ data }}</HelloWorld>
  </div>
</template>
```
*/
class App {
    /** App 的消息 */
    private msg = "消息";
    private data = "数据";

    /**
     * 将上面的模版编译为下面的实现(格式化后)
     * 1. 对编译前每个有效的位置都有一个映射后的位置，如果该位置无效，那么值为 0
     */
    render() {
        // predefine
        const div = document.createElement("div");
        const img = document.createElement("img");
        // 引入的组件
        // body
        {
            // 属性
            let { id } = div;
            id = "app";
            {
                let { alt, src, className } = img;
                alt = "Vue logo";
                src = "./assets/logo.png";
            }
            HelloWorld;
            {
                let { msg } = new HelloWorld();
                msg = this.msg;
                // content
                this.data;
            }
        }
    }
}

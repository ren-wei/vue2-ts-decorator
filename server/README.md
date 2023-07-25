# 代码设计思路

`VueLanguageService` 提供语法服务器需要的所有功能

* 将 template 编译为 render 函数得到虚拟的 ts 文件和文件位置映射

```html
<template>
  <div id="app">
    <img alt="Vue logo" src="./assets/logo.png">
    <HelloWorld :msg="msg"/>
  </div>
</template>
```

编译为(格式化后):

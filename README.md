# pdf-to-img_fork

此项目fork自https://github.com/k-yle/pdf-to-img，

原项目将每个pdf页面直接暴露为Buffer类型，使用的时候通过fs.write直接存图片即可。

最近有需求，由于需要根据PDF内容提取部分页面并转为图片，所以需要一个在PDF中搜索的功能，由于原项目并未暴露PDFDocumentProxy，所以做了以下修改：

1. 暴露了PDFDocumentProxy，方便外面根据需要使用。
2. 提供search方法，用于搜索整个PDF文档。
3. 提供searchInPage方法，用于在PDF文档的某页面搜索。
4. 增加配置项searchViewLength，用于设置搜索返回的字符长度，即被搜索字符串前后的字符数。

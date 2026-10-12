// CEP keeps Node's require on cep_node; the bundle expects it as a global.
if (!window.require && window.cep_node) window.require = window.cep_node.require

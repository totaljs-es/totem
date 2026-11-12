---
title: Data: DATA on the embedded NoSQL database
keywords: nosql, database, db, storage, store, save, insert, find, read, modify, update, remove, delete, collection, datos, base, guardar, data, querybuilder, postgresql
strong: nosql
---
The records of an application go through `DATA` (QueryBuilder). On the embedded NoSQL database the table has the prefix `nosql/`, and it needs no definition and no dependency. Every builder ends with `.promise($)` (or `.callback(function(err, response) { })`).

```js
var item = { id: UID(), name: 'Peter', dtcreated: NOW };

await DATA.insert('nosql/tbl_user', item).promise($);
var list = await DATA.find('nosql/tbl_user').where('name', 'Peter').sort('dtcreated_desc').take(10).promise($);
var one = await DATA.read('nosql/tbl_user').id(id).error(404).promise($);
await DATA.modify('nosql/tbl_user', { name: 'Paul' }).id(id).error(404).promise($);
await DATA.remove('nosql/tbl_user').id(id).error(404).promise($);
```

`UID()` makes an id and `NOW` is the current date. `.error(404)` answers the action with 404 when nothing is found. Name the tables and the fields as in SQL from the start (`tbl_user`, `isactive`, `dtcreated`): the application then moves to PostgreSQL by adding the definition of its adapter and taking the prefix `nosql/` away, without writing a query again.

`NOSQL('name')` is the same embedded database used directly: it is for a store that will never be SQL (a log, a queue). `MEMORIZE('name')` keeps a small object by itself (settings, counters) and `FILESTORAGE('name')` keeps files.

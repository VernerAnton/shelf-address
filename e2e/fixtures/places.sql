-- The small tree most suites start from.
INSERT INTO locations (id, parent_id, kind, label, sort_order) VALUES ('s1', NULL, 'site', 'Store', 0), ('w1', NULL, 'site', 'Warehouse A', 1);
INSERT INTO locations (id, parent_id, kind, label, address, address_key) VALUES ('sh1', 's1', 'shelf', 'Wall unit', 'Bulevard 1', 'bulevard 1');
INSERT INTO locations (id, parent_id, kind, label) VALUES ('r2', 'sh1', 'node', 'Row 2'), ('b1', 'w1', 'node', 'Box 3'), ('x1', 'w1', 'node', 'Temp table');

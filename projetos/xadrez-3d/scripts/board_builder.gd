class_name BoardBuilder
extends RefCounted

## Fábrica do tabuleiro 8x8. Gera as 64 casas proceduralmente sob `parent`.
## Mesh e Shape são únicos e compartilhados -> zero churn de memória por casa.

const FILES := 8
const RANKS := 8
const LIGHT_COLOR := Color("f0d9b5")
const DARK_COLOR := Color("b58863")


## Devolve as casas indexadas por `rank * 8 + file`.
static func build(parent: Node) -> Array[Square]:
	var box := BoxMesh.new()
	box.size = Vector3(Square.SIZE, Square.THICKNESS, Square.SIZE)

	var shape := BoxShape3D.new()
	shape.size = box.size

	var squares: Array[Square] = []
	squares.resize(FILES * RANKS)

	for rank in RANKS:
		for file in FILES:
			var square := Square.new()
			square.setup(
				Vector2i(file, rank),
				(file + rank) % 2 == 0,  # a1 escura, h1 clara
				box,
				shape,
				LIGHT_COLOR,
				DARK_COLOR
			)
			parent.add_child(square)
			squares[rank * FILES + file] = square

	return squares

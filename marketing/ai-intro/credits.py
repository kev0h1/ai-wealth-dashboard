from common import FLOOR, balance

b = balance()
print(f"remaining ${b:.4f}  floor ${FLOOR:.2f}  headroom ${b - FLOOR:.4f}")

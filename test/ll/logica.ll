; ModuleID = 'logica.c'
source_filename = "logica.c"
target datalayout = "e-m:e-p:32:32-i64:64-n32-S128"
target triple = "riscv32-unknown-unknown"

@chamadas = dso_local global i32 0, align 4

; Function Attrs: noinline nounwind optnone
define dso_local i32 @positivo(i32 noundef %0) #0 {
  %2 = alloca i32, align 4
  store i32 %0, ptr %2, align 4
  %3 = load i32, ptr @chamadas, align 4
  %4 = add nsw i32 %3, 1
  store i32 %4, ptr @chamadas, align 4
  %5 = load i32, ptr %2, align 4
  %6 = icmp sgt i32 %5, 0
  %7 = zext i1 %6 to i32
  ret i32 %7
}

; Function Attrs: noinline nounwind optnone
define dso_local i32 @main() #0 {
  %1 = alloca i32, align 4
  %2 = alloca i32, align 4
  %3 = alloca i32, align 4
  store i32 0, ptr %1, align 4
  store i32 -1, ptr %2, align 4
  store i32 5, ptr %3, align 4
  %4 = load i32, ptr %2, align 4
  %5 = call i32 @positivo(i32 noundef %4)
  %6 = icmp ne i32 %5, 0
  br i1 %6, label %7, label %12

7:                                                ; preds = %0
  %8 = load i32, ptr %3, align 4
  %9 = call i32 @positivo(i32 noundef %8)
  %10 = icmp ne i32 %9, 0
  br i1 %10, label %11, label %12

11:                                               ; preds = %7
  store i32 100, ptr %1, align 4
  br label %23

12:                                               ; preds = %7, %0
  %13 = load i32, ptr %3, align 4
  %14 = call i32 @positivo(i32 noundef %13)
  %15 = icmp ne i32 %14, 0
  br i1 %15, label %20, label %16

16:                                               ; preds = %12
  %17 = load i32, ptr %2, align 4
  %18 = call i32 @positivo(i32 noundef %17)
  %19 = icmp ne i32 %18, 0
  br i1 %19, label %20, label %22

20:                                               ; preds = %16, %12
  %21 = load i32, ptr @chamadas, align 4
  store i32 %21, ptr %1, align 4
  br label %23

22:                                               ; preds = %16
  store i32 0, ptr %1, align 4
  br label %23

23:                                               ; preds = %22, %20, %11
  %24 = load i32, ptr %1, align 4
  ret i32 %24
}

attributes #0 = { noinline nounwind optnone "frame-pointer"="all" "no-trapping-math"="true" "stack-protector-buffer-size"="8" "target-cpu"="generic-rv32" "target-features"="+32bit,+f,+m,+relax,+zicsr,-a,-c,-d,-e,-experimental-zacas,-experimental-zcmop,-experimental-zfbfmin,-experimental-zicfilp,-experimental-zicfiss,-experimental-zimop,-experimental-ztso,-experimental-zvfbfmin,-experimental-zvfbfwma,-h,-smaia,-smepmp,-ssaia,-svinval,-svnapot,-svpbmt,-v,-xcvalu,-xcvbi,-xcvbitmanip,-xcvelw,-xcvmac,-xcvmem,-xcvsimd,-xsfvcp,-xsfvfnrclipxfqf,-xsfvfwmaccqqq,-xsfvqmaccdod,-xsfvqmaccqoq,-xtheadba,-xtheadbb,-xtheadbs,-xtheadcmo,-xtheadcondmov,-xtheadfmemidx,-xtheadmac,-xtheadmemidx,-xtheadmempair,-xtheadsync,-xtheadvdot,-xventanacondops,-za128rs,-za64rs,-zawrs,-zba,-zbb,-zbc,-zbkb,-zbkc,-zbkx,-zbs,-zca,-zcb,-zcd,-zce,-zcf,-zcmp,-zcmt,-zdinx,-zfa,-zfh,-zfhmin,-zfinx,-zhinx,-zhinxmin,-zic64b,-zicbom,-zicbop,-zicboz,-ziccamoa,-ziccif,-zicclsm,-ziccrse,-zicntr,-zicond,-zifencei,-zihintntl,-zihintpause,-zihpm,-zk,-zkn,-zknd,-zkne,-zknh,-zkr,-zks,-zksed,-zksh,-zkt,-zmmul,-zvbb,-zvbc,-zve32f,-zve32x,-zve64d,-zve64f,-zve64x,-zvfh,-zvfhmin,-zvkb,-zvkg,-zvkn,-zvknc,-zvkned,-zvkng,-zvknha,-zvknhb,-zvks,-zvksc,-zvksed,-zvksg,-zvksh,-zvkt,-zvl1024b,-zvl128b,-zvl16384b,-zvl2048b,-zvl256b,-zvl32768b,-zvl32b,-zvl4096b,-zvl512b,-zvl64b,-zvl65536b,-zvl8192b" }

!llvm.module.flags = !{!0, !1, !2, !3}
!llvm.ident = !{!4}

!0 = !{i32 1, !"wchar_size", i32 4}
!1 = !{i32 1, !"target-abi", !"ilp32f"}
!2 = !{i32 7, !"frame-pointer", i32 2}
!3 = !{i32 8, !"SmallDataLimit", i32 8}
!4 = !{!"Ubuntu clang version 18.1.3 (1ubuntu1)"}
